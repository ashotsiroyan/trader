import { Body, Controller, Get, Post, Render, Res } from '@nestjs/common';
import { Response } from 'express';
import { CreateSymbolDto } from './symbols/dto/create-symbol.dto';
import { SymbolsService } from './symbols/symbols.service';

@Controller()
export class AppController {
  constructor(
    private readonly symbolsService: SymbolsService
  ) {}
  
  @Get()
  @Render('index')
  getHome() { }

  @Post('submit')
  async handleHomeForm(@Body() body: CreateSymbolDto, @Res() res: Response) {
    await this.symbolsService.createSymbol(body);
    
    res.redirect('/');
  }

  @Post('restart-timeouts')
  async restartTimeouts(@Res() res: Response) {
    await this.symbolsService.restartTimeouts();
    
    res.redirect('/');
  }

  @Get('statistics')
  getStatistics(){
    return this.symbolsService.getStatistics();
  }
}
